import { useQuery } from '@tanstack/react-query';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { CardSkeleton } from '../../components/Skeleton';
import { supabase } from '../../lib/supabase';
import { getLevelInfo } from '../../lib/levels';

export function AdminRedditAccounts() {
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['allRedditAccounts'],
    queryFn: async () => {
      const { data } = await supabase
        .from('reddit_accounts')
        .select('*, users(email, full_name)')
        .order('karma', { ascending: false });
      return data || [];
    },
  });

  return (
    <Layout userRole="admin">
      <div className="mb-5">
        <p className="text-xs uppercase tracking-wide font-bold text-muted">Admin Console</p>
        <h1 className="text-2xl sm:text-3xl font-extrabold">Akun Reddit</h1>
        <p className="text-sm text-muted">{accounts.length} akun terdaftar</p>
      </div>

      {isLoading ? (
        <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>
      ) : accounts.length === 0 ? (
        <Card className="text-center py-10">
          <div className="text-5xl mb-3">🔗</div>
          <p className="font-bold">Belum ada akun Reddit</p>
        </Card>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {accounts.map((a: any) => {
              const lvl = getLevelInfo(a.level);
              return (
                <Card key={a.id} padding="sm">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="font-bold truncate">u/{a.username}</p>
                      <p className="text-xs text-muted truncate">{a.users?.email}</p>
                    </div>
                    <p className="text-xl font-extrabold money shrink-0">{a.karma}</p>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="bg-primary/10 text-primary font-bold px-2 py-0.5 rounded-full">
                      {lvl.emoji} {lvl.name}
                    </span>
                    <span className="text-muted">{a.account_age_days}d • sync {new Date(a.last_sync).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</span>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Desktop table */}
          <Card className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-2 py-2 font-semibold text-muted">Username</th>
                  <th className="px-2 py-2 font-semibold text-muted">Owner</th>
                  <th className="px-2 py-2 font-semibold text-muted">Karma</th>
                  <th className="px-2 py-2 font-semibold text-muted">Level</th>
                  <th className="px-2 py-2 font-semibold text-muted">Age (days)</th>
                  <th className="px-2 py-2 font-semibold text-muted">Last Sync</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a: any) => {
                  const lvl = getLevelInfo(a.level);
                  return (
                    <tr key={a.id} className="border-b border-border last:border-0 hover:bg-light">
                      <td className="px-2 py-3 font-bold">u/{a.username}</td>
                      <td className="px-2 py-3 text-muted">{a.users?.email}</td>
                      <td className="px-2 py-3 money font-semibold">{a.karma}</td>
                      <td className="px-2 py-3">
                        <span className="bg-primary/10 text-primary font-bold text-xs px-2 py-0.5 rounded-full">
                          {lvl.emoji} {lvl.name}
                        </span>
                      </td>
                      <td className="px-2 py-3">{a.account_age_days}</td>
                      <td className="px-2 py-3 text-muted">
                        {new Date(a.last_sync).toLocaleDateString('id-ID')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </Layout>
  );
}
