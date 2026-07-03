import { useEffect, useState, useMemo } from 'react';
import {
  Search,
  RefreshCw,
  Download,
  Clock,
  Tag,
  Globe,
  FileText,
  CheckCircle2,
  XCircle,
  Send,
  Loader2,
  Filter,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { AdminLayout, AdminBreadcrumb } from '../../components/AdminLayout';
import { supabase } from '../../../../lib/supabase';

interface WaitlistRow {
  id: string;
  email: string;
  seed_keyword: string | null;
  brand: string | null;
  website: string | null;
  notes: string | null;
  status: 'pending' | 'invited' | 'converted' | 'declined';
  user_agent: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 border-amber-200',
  invited: 'bg-blue-100 text-blue-700 border-blue-200',
  converted: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  declined: 'bg-slate-100 text-slate-600 border-slate-200',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  invited: 'Invited',
  converted: 'Converted',
  declined: 'Declined',
};

export function AdminWaitlist() {
  const [rows, setRows] = useState<WaitlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | WaitlistRow['status']>('all');
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'newest' | 'oldest'>('newest');

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('waitlist')
        .select('*')
        .order('created_at', { ascending: sortBy === 'oldest' });
      if (error) throw error;
      setRows(data || []);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load waitlist');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [sortBy]);

  const updateStatus = async (id: string, status: WaitlistRow['status']) => {
    setUpdatingId(id);
    try {
      const { error } = await supabase
        .from('waitlist')
        .update({ status })
        .eq('id', id);
      if (error) throw error;
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
      toast.success(`Marked as ${STATUS_LABELS[status]}`);
    } catch (err: any) {
      toast.error(err.message || 'Update failed');
    } finally {
      setUpdatingId(null);
    }
  };

  const exportCSV = () => {
    const headers = ['Email', 'Keyword', 'Brand', 'Website', 'Notes', 'Status', 'Created At'];
    const lines = filtered.map((r) => [
      r.email,
      r.seed_keyword || '',
      r.brand || '',
      r.website || '',
      (r.notes || '').replace(/\n/g, ' '),
      r.status,
      new Date(r.created_at).toLocaleString(),
    ]);
    const csv = [headers, ...lines].map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `straight-waitlist-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV exported');
  };

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        return (
          r.email.toLowerCase().includes(q) ||
          (r.seed_keyword || '').toLowerCase().includes(q) ||
          (r.brand || '').toLowerCase().includes(q) ||
          (r.website || '').toLowerCase().includes(q) ||
          (r.notes || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [rows, statusFilter, query]);

  const stats = useMemo(() => {
    return {
      total: rows.length,
      pending: rows.filter((r) => r.status === 'pending').length,
      invited: rows.filter((r) => r.status === 'invited').length,
      converted: rows.filter((r) => r.status === 'converted').length,
      declined: rows.filter((r) => r.status === 'declined').length,
    };
  }, [rows]);

  return (
    <AdminLayout>
      <div className="p-6 md:p-10 max-w-7xl mx-auto">
        <AdminBreadcrumb items={[{ label: 'Admin', href: '/reddit/admin' }, { label: 'Waitlist' }]} />

        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Waitlist</h1>
            <p className="text-slate-600 mt-1">
              {stats.total} total · {stats.pending} pending · {stats.invited} invited · {stats.converted} converted
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportCSV}
              disabled={filtered.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-sm font-semibold"
            >
              <Download size={16} />
              Export CSV
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-semibold"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              Refresh
            </button>
          </div>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {[
            { label: 'Total', value: stats.total, color: 'bg-slate-900 text-white' },
            { label: 'Pending', value: stats.pending, color: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200' },
            { label: 'Invited', value: stats.invited, color: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' },
            { label: 'Converted', value: stats.converted, color: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
            { label: 'Declined', value: stats.declined, color: 'bg-slate-50 text-slate-600 ring-1 ring-slate-200' },
          ].map((s) => (
            <div key={s.label} className={`rounded-xl p-4 ${s.color}`}>
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-xs font-medium opacity-80 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search email, keyword, brand, website..."
              className="w-full pl-9 pr-4 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-slate-400" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="px-3 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900 text-sm bg-white"
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="invited">Invited</option>
              <option value="converted">Converted</option>
              <option value="declined">Declined</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3 py-2.5 rounded-lg ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900 text-sm bg-white"
            >
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-8 text-center text-slate-500">
            <Loader2 size={24} className="animate-spin mx-auto mb-2" />
            Loading waitlist...
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-8 text-center text-slate-500">
            {query || statusFilter !== 'all' ? 'No matches for your filter.' : 'No waitlist entries yet.'}
          </div>
        ) : (
          <div className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">Email</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">Details</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">Submitted</th>
                    <th className="text-left px-4 py-3 font-semibold text-slate-700">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{row.email}</div>
                        {row.user_agent && (
                          <div className="text-xs text-slate-400 mt-0.5 truncate max-w-[200px]">{row.user_agent}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          {row.seed_keyword && (
                            <div className="flex items-center gap-1.5 text-xs text-slate-600">
                              <Tag size={12} className="text-orange-500" />
                              {row.seed_keyword}
                            </div>
                          )}
                          {row.brand && (
                            <div className="flex items-center gap-1.5 text-xs text-slate-600">
                              <FileText size={12} className="text-blue-500" />
                              {row.brand}
                            </div>
                          )}
                          {row.website && (
                            <div className="flex items-center gap-1.5 text-xs text-slate-600">
                              <Globe size={12} className="text-emerald-500" />
                              {row.website}
                            </div>
                          )}
                          {row.notes && (
                            <div className="text-xs text-slate-500 max-w-[250px] line-clamp-2" title={row.notes}>
                              {row.notes}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold border ${STATUS_STYLES[row.status]}`}
                        >
                          {row.status === 'pending' && <Clock size={12} />}
                          {row.status === 'invited' && <Send size={12} />}
                          {row.status === 'converted' && <CheckCircle2 size={12} />}
                          {row.status === 'declined' && <XCircle size={12} />}
                          {STATUS_LABELS[row.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                        {new Date(row.created_at).toLocaleDateString()}
                        <div className="text-xs text-slate-400">
                          {new Date(row.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {updatingId === row.id ? (
                            <Loader2 size={14} className="animate-spin text-slate-400" />
                          ) : (
                            <>
                              {row.status !== 'invited' && (
                                <button
                                  onClick={() => updateStatus(row.id, 'invited')}
                                  title="Mark invited"
                                  className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600"
                                >
                                  <Send size={14} />
                                </button>
                              )}
                              {row.status !== 'converted' && (
                                <button
                                  onClick={() => updateStatus(row.id, 'converted')}
                                  title="Mark converted"
                                  className="p-1.5 rounded-lg hover:bg-emerald-50 text-emerald-600"
                                >
                                  <CheckCircle2 size={14} />
                                </button>
                              )}
                              {row.status !== 'declined' && (
                                <button
                                  onClick={() => updateStatus(row.id, 'declined')}
                                  title="Mark declined"
                                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                                >
                                  <XCircle size={14} />
                                </button>
                              )}
                              {row.status !== 'pending' && (
                                <button
                                  onClick={() => updateStatus(row.id, 'pending')}
                                  title="Reset to pending"
                                  className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-600"
                                >
                                  <Clock size={14} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
