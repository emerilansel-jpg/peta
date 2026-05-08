import React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, Plus, Trash2, X, LogOut, Copy, MessageCircle, Pencil, Check } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { CardSkeleton } from '../components/Skeleton';
import { SocialShare } from '../components/SocialShare';
import { supabase } from '../lib/supabase';
import { getRedditAccounts, addRedditAccount, updateRedditAccountKarma, getReferralStats } from '../lib/api';
import { getLevelInfo, LEVELS } from '../lib/levels';
import { toast } from '../components/Toast';

export function Account() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [user, setUser] = React.useState<any>(null);
  const [newUsername, setNewUsername] = React.useState('');
  const [showSheet, setShowSheet] = React.useState(params.get('add') === '1');
  const [editingWa, setEditingWa] = React.useState(false);
  const [waValue, setWaValue] = React.useState('');

  React.useEffect(() => {
    if (params.get('add') === '1') {
      // Strip the param so refreshes don't re-open the sheet
      params.delete('add');
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { navigate('/login'); return; }
      setUser(data.user);
    })();
  }, [navigate]);

  const { data: accounts = [], isLoading, refetch } = useQuery({
    queryKey: ['redditAccounts', user?.id],
    queryFn: () => getRedditAccounts(user!.id),
    enabled: !!user?.id,
  });

  const { data: profile, refetch: refetchProfile } = useQuery({
    queryKey: ['userProfile', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('users')
        .select('email, full_name, whatsapp')
        .eq('id', user!.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user?.id,
  });

  const { data: referral } = useQuery({
    queryKey: ['referral', user?.id],
    queryFn: () => getReferralStats(user!.id),
    enabled: !!user?.id,
  });

  React.useEffect(() => {
    if (profile?.whatsapp) setWaValue(profile.whatsapp);
  }, [profile?.whatsapp]);

  const saveWa = async () => {
    const cleaned = waValue.replace(/\D/g, '').replace(/^0/, '62');
    if (cleaned.length < 9) { toast.error('Nomor WhatsApp tidak valid'); return; }
    const { error } = await supabase.from('users').update({ whatsapp: cleaned }).eq('id', user.id);
    if (error) { toast.error(error.message); return; }
    toast.success('WhatsApp tersimpan ✅');
    setEditingWa(false);
    refetchProfile();
  };

  // Referral link points at the homepage so friends read the landing copy
  // first; Landing.tsx forwards ?ref= to /register on CTA click.
  const refLink = referral?.code
    ? `${window.location.origin}/?ref=${referral.code}`
    : '';
  // (Old single-WhatsApp share text removed — <SocialShare> now owns
  // the message templating across all channels.)

  // Robust copy that works on http://localhost too (Clipboard API needs HTTPS or localhost)
  const copyToClipboard = async (text: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {/* fall through */}
    // Fallback using a hidden textarea + execCommand
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  };

  const copyRefLink = async () => {
    if (!refLink) { toast.error('Kode referral belum siap, refresh dulu'); return; }
    const ok = await copyToClipboard(refLink);
    if (ok) toast.success('Link tersalin 📋');
    else toast.error('Gagal menyalin — copy manual ya');
  };


  const addMutation = useMutation({
    mutationFn: (username: string) => addRedditAccount(user.id, username),
    onSuccess: () => {
      toast.success('Akun ditambahkan ✅');
      setNewUsername('');
      setShowSheet(false);
      refetch();
    },
    onError: (e: any) => {
      const msg = e?.message || '';
      if (e?.code === '23505' || /duplicate|unique/i.test(msg)) {
        toast.error('Username Reddit sudah terdaftar.');
      } else {
        toast.error(msg || 'Gagal menambahkan akun');
      }
    },
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) =>
      updateRedditAccountKarma(id, accounts.find((a) => a.id === id)?.username),
    onSuccess: () => { toast.success('Karma disync 📊'); refetch(); },
    onError: () => toast.error('Gagal sync karma'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('reddit_accounts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Akun dihapus'); refetch(); },
    onError: () => toast.error('Gagal menghapus akun'),
  });

  const handleAdd = () => {
    let u = newUsername.trim();
    if (!u) { toast.error('Masukkan username Reddit'); return; }
    if (u.startsWith('u/')) u = u.slice(2);
    if (u.includes('reddit.com/user/')) u = u.split('reddit.com/user/')[1].split(/[/?]/)[0];
    addMutation.mutate(u);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  if (isLoading) {
    return (
      <Layout userRole="army">
        <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>
      </Layout>
    );
  }

  return (
    <Layout userRole="army">
      <div className="mb-5">
        <h1 className="text-2xl sm:text-3xl font-extrabold">Akun Saya</h1>
        <p className="text-sm text-muted">{user?.email}</p>
      </div>

      {/* WhatsApp */}
      <Card className="mb-3" padding="sm">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 bg-success/15 text-success rounded-lg grid place-items-center shrink-0">
              <MessageCircle size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase font-bold tracking-wide text-muted">WhatsApp</p>
              {editingWa ? (
                <input
                  type="tel"
                  inputMode="tel"
                  value={waValue}
                  onChange={(e) => setWaValue(e.target.value)}
                  placeholder="08xxxxxxxxxx"
                  className="text-base font-bold bg-light px-3 py-1.5 rounded-lg w-full max-w-[220px] focus:outline-none focus:ring-2 focus:ring-primary"
                  autoFocus
                />
              ) : (
                <p className="font-bold truncate">{profile?.whatsapp || <span className="text-muted font-normal">Belum diisi</span>}</p>
              )}
            </div>
          </div>
          {editingWa ? (
            <div className="flex gap-1 shrink-0">
              <button onClick={saveWa} className="tap-shrink p-2 bg-success text-white rounded-lg hover:brightness-95">
                <Check size={16} />
              </button>
              <button onClick={() => { setEditingWa(false); setWaValue(profile?.whatsapp || ''); }} className="tap-shrink p-2 bg-light text-muted rounded-lg">
                <X size={16} />
              </button>
            </div>
          ) : (
            <button onClick={() => setEditingWa(true)} className="tap-shrink p-2 text-primary hover:bg-primary/10 rounded-lg">
              <Pencil size={16} />
            </button>
          )}
        </div>
      </Card>

      {/* Referral */}
      <Card className="mb-5 bg-gradient-to-br from-yellow-50 to-orange-50 ring-yellow-200">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <p className="text-[10px] uppercase font-bold tracking-wide text-yellow-800">Ajak Teman</p>
            <p className="text-base font-bold leading-tight">Tiap teman daftar = Rp20K untuk kamu</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-[10px] uppercase font-bold tracking-wide text-muted">Diundang</p>
            <p className="text-2xl font-extrabold money">{referral?.invitedCount ?? 0}</p>
          </div>
        </div>

        <button
          onClick={copyRefLink}
          disabled={!refLink}
          className="tap-shrink w-full bg-white rounded-xl px-3 py-2.5 mb-3 flex items-center justify-between gap-2 ring-1 ring-yellow-200 hover:ring-primary disabled:opacity-50"
        >
          <div className="min-w-0 text-left">
            <p className="text-[10px] uppercase font-bold tracking-wide text-muted">Kode kamu — klik untuk salin link</p>
            <p className="font-extrabold uppercase tracking-wider truncate">{referral?.code || '...'}</p>
          </div>
          <Copy size={20} className="text-primary shrink-0" />
        </button>

        {refLink ? (
          <div className="bg-dark/90 text-white rounded-xl p-3">
            <SocialShare link={refLink} title="Share link kamu" />
          </div>
        ) : (
          <Button onClick={copyRefLink} variant="outline" size="md" disabled fullWidth>
            <Copy size={16} /> Loading...
          </Button>
        )}
        {(referral?.totalBonus ?? 0) > 0 && (
          <p className="text-xs text-success font-semibold text-center mt-3">
            🎉 Total bonus referral: Rp{(referral?.totalBonus ?? 0).toLocaleString('id-ID')}
          </p>
        )}
      </Card>

      {/* Reddit Accounts */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-extrabold">Akun Reddit</h2>
        <button
          onClick={() => setShowSheet(true)}
          className="tap-shrink text-primary text-sm font-bold flex items-center gap-1 hover:underline"
        >
          <Plus size={16} /> Tambah
        </button>
      </div>

      {accounts.length === 0 ? (
        <Card className="text-center py-10">
          <div className="text-5xl mb-3">🎯</div>
          <p className="font-bold mb-1">Hubungkan akun Reddit pertama</p>
          <p className="text-sm text-muted mb-5">Wajib supaya bisa ambil task & cair.</p>
          <Button onClick={() => setShowSheet(true)} variant="primary" fullWidth>
            <Plus size={18} /> Tambah Akun Reddit
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => {
            const lvl = getLevelInfo(account.level);
            const nextIdx = Math.min(account.level + 1, LEVELS.length - 1);
            const next = LEVELS[nextIdx];
            const progress = next.maxKarma === Infinity
              ? 100
              : Math.min((account.karma / (next.maxKarma + 1)) * 100, 100);

            return (
              <Card key={account.id}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <p className="font-extrabold text-lg truncate">u/{account.username}</p>
                    <p className="text-sm text-primary font-semibold">
                      {lvl.emoji} {lvl.name}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-2xl font-extrabold money">{account.karma}</p>
                    <p className="text-[10px] text-muted">karma</p>
                  </div>
                </div>

                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-muted">Progress ke {next.emoji} {next.name}</span>
                    <span className="font-bold text-dark">{Math.round(progress)}%</span>
                  </div>
                  <div className="w-full h-2 bg-light rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-secondary rounded-full transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-4 text-xs">
                  <div className="bg-light rounded-lg p-2.5">
                    <p className="text-muted">Umur akun</p>
                    <p className="font-bold text-base">{account.account_age_days} hari</p>
                  </div>
                  <div className="bg-light rounded-lg p-2.5">
                    <p className="text-muted">Reward/task</p>
                    <p className="font-bold text-base text-primary money">
                      Rp{lvl.reward.toLocaleString('id-ID')}
                    </p>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button
                    onClick={() => syncMutation.mutate(account.id)}
                    variant="outline"
                    size="md"
                    loading={syncMutation.isPending}
                    fullWidth
                  >
                    <RefreshCw size={16} /> Sync Karma
                  </Button>
                  <Button
                    onClick={() => {
                      if (confirm(`Hapus akun u/${account.username}?`)) {
                        deleteMutation.mutate(account.id);
                      }
                    }}
                    variant="ghost"
                    size="md"
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Logout (mobile) */}
      <button
        onClick={handleLogout}
        className="md:hidden w-full mt-6 flex items-center justify-center gap-2 py-3 text-muted font-semibold tap-shrink"
      >
        <LogOut size={18} /> Logout
      </button>

      {/* Bottom sheet: add account */}
      {showSheet && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowSheet(false)} />
          <div className="relative bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-2xl animate-slide-up safe-bottom">
            <div className="p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-extrabold">Tambah akun Reddit</h3>
                <button onClick={() => setShowSheet(false)} className="p-2 -mr-2 text-muted hover:text-dark">
                  <X size={22} />
                </button>
              </div>
              <p className="text-sm text-muted mb-4">Format apa aja boleh: <b>u/nama</b>, <b>nama</b>, atau URL profil lengkap.</p>
              <input
                type="text"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="u/username_kamu"
                className="w-full min-h-[48px] px-4 py-3 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition mb-4"
                autoFocus
              />
              <Button
                onClick={handleAdd}
                variant="primary"
                size="lg"
                loading={addMutation.isPending}
                fullWidth
              >
                ✅ Tambah Akun
              </Button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
