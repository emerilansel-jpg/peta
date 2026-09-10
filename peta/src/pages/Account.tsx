import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { LogOut, MessageCircle, Pencil, Check, AlertTriangle, Target, X, Copy, Trash2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { CardSkeleton } from '../components/Skeleton';
import { SocialShare } from '../components/SocialShare';
import { supabase } from '../lib/supabase';
import { getReferralStats, getReferralAnalytics } from '../lib/api';
import { toast } from '../components/Toast';

export function Account() {
  const navigate = useNavigate();
  const [user, setUser] = React.useState<any>(null);
  const [editingWa, setEditingWa] = React.useState(false);
  const [waValue, setWaValue] = React.useState('');
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteConfirm, setDeleteConfirm] = React.useState('');
  const [deleting, setDeleting] = React.useState(false);

  React.useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { navigate('/login'); return; }
      setUser(data.user);
    })();
  }, [navigate]);

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

  const { data: refAnalytics } = useQuery({
    queryKey: ['referralAnalytics', user?.id],
    queryFn: () => getReferralAnalytics(user!.id),
    enabled: !!user?.id,
    refetchInterval: 180_000,
  });

  // Check if user is a Hero Army (has active reddit_army_profiles)
  const { data: heroArmyProfile } = useQuery({
    queryKey: ['heroArmyCheck', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('reddit_army_profiles')
        .select('program_status, current_challenge_level')
        .eq('user_id', user!.id)
        .in('program_status', ['phase1_active', 'phase1_complete', 'phase2_active'])
        .maybeSingle();
      return data;
    },
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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  const handleDeleteAccount = async () => {
    // Type-to-confirm: user must type their email exactly. The actual delete
    // is server-side via self_delete_account() RPC, which is SECURITY DEFINER
    // and scoped to auth.uid() (the owner). No p_user_id param — callers can
    // only ever delete their own account.
    if (deleteConfirm.trim().toLowerCase() !== (user?.email || '').toLowerCase()) {
      toast.error('Email ketikannya nggak cocok. Ketik email kamu persis.');
      return;
    }
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('self_delete_account');
      if (error) throw error;
      await supabase.auth.signOut();
      toast.success('Akun kamu udah dihapus permanen. Sampai jumpa! 👋');
      navigate('/');
    } catch (e: any) {
      toast.error(e?.message || 'Gagal menghapus akun. Coba lagi atau hubungi admin.');
    } finally {
      setDeleting(false);
    }
  };

  if (!user) {
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

        {/* Performance dashboard — clicks / signups / CR / earned.
            Updates every 30s. Reads from referral_clicks + users.referred_by. */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-white rounded-lg p-2.5 ring-1 ring-yellow-200/60">
            <p className="text-[10px] uppercase font-bold text-muted leading-none">Klik</p>
            <p className="text-lg font-extrabold tabular-nums leading-tight mt-1">
              {refAnalytics?.uniqueClicks ?? 0}
            </p>
            <p className="text-[10px] text-muted leading-none">
              {refAnalytics?.totalClicks !== undefined && refAnalytics.totalClicks !== refAnalytics.uniqueClicks
                ? `${refAnalytics.totalClicks} total`
                : 'unik'}
            </p>
          </div>
          <div className="bg-white rounded-lg p-2.5 ring-1 ring-yellow-200/60">
            <p className="text-[10px] uppercase font-bold text-muted leading-none">Daftar</p>
            <p className="text-lg font-extrabold tabular-nums leading-tight mt-1">
              {refAnalytics?.signups ?? 0}
            </p>
            <p className="text-[10px] text-muted leading-none">teman gabung</p>
          </div>
          <div className="bg-white rounded-lg p-2.5 ring-1 ring-yellow-200/60">
            <p className="text-[10px] uppercase font-bold text-muted leading-none">Conversion</p>
            <p className="text-lg font-extrabold tabular-nums leading-tight mt-1">
              {(refAnalytics?.conversionRate ?? 0)}%
            </p>
            <p className="text-[10px] text-muted leading-none">klik → daftar</p>
          </div>
          <div className="bg-success/10 rounded-lg p-2.5 ring-1 ring-success/30">
            <p className="text-[10px] uppercase font-bold text-success/80 leading-none">Cuan</p>
            <p className="text-lg font-extrabold tabular-nums leading-tight mt-1 text-success">
              Rp{((refAnalytics?.totalEarned ?? 0) / 1000).toLocaleString('id-ID')}K
            </p>
            <p className="text-[10px] text-success/80 leading-none">total bonus</p>
          </div>
        </div>

        {refAnalytics && refAnalytics.uniqueClicks >= 5 && refAnalytics.signups === 0 && (
          <p className="text-xs text-warning font-semibold mt-3 text-center">
            ⚡ Banyak klik tapi belum ada yang daftar. Coba tweak caption — soroti bonus Rp25K + scarcity.
          </p>
        )}
        {refAnalytics && refAnalytics.signups > 0 && (
          <p className="text-xs text-success font-semibold text-center mt-3">
            🎉 {refAnalytics.signups} teman udah gabung — cuan kamu Rp{(refAnalytics.totalEarned).toLocaleString('id-ID')} dari referral
          </p>
        )}
      </Card>

      {/* Hero Army Banner — only shown for active hero army members */}
      {heroArmyProfile && (
        <Card className="mb-4 bg-gradient-to-br from-purple-50 to-indigo-50 border border-purple-200">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-100 text-purple-600 rounded-xl grid place-items-center shrink-0">
                <Target size={20} />
              </div>
              <div>
                <p className="text-xs text-purple-600 font-bold uppercase tracking-wide">Hero Army</p>
                <p className="font-bold text-sm">
                  Level {heroArmyProfile.current_challenge_level} • {
                    heroArmyProfile.program_status === 'phase1_active' ? 'Fase 1 — Warmup' :
                    heroArmyProfile.program_status === 'phase1_complete' ? 'Fase 1 Selesai' :
                    'Fase 2 — Active Income'
                  }
                </p>
              </div>
            </div>
            <Button
              onClick={() => navigate('/reddit-army')}
              variant="primary"
              size="sm"
              className="!bg-purple-600 hover:!brightness-110"
            >
              Cek Reddit Army →
            </Button>
          </div>
        </Card>
      )}

      {/* Help */}
      <div className="mt-6 p-4 bg-gradient-to-br from-gray-50 to-white rounded-2xl border border-gray-100">
        <p className="text-[10px] uppercase font-bold tracking-wide text-muted mb-2">Bantuan</p>
        <a href="/help" className="flex items-center gap-2 text-sm font-semibold text-primary hover:underline tap-shrink">
          📖 Panduan PeTa
        </a>
        <p className="text-[11px] text-muted mt-1">
          Cara kerja task, payout, Reddit Army, FAQ & tips.
        </p>
      </div>

      {/* Logout (mobile) */}
      <button
        onClick={handleLogout}
        className="md:hidden w-full mt-6 flex items-center justify-center gap-2 py-3 text-muted font-semibold tap-shrink"
      >
        <LogOut size={18} /> Logout
      </button>

      {/* Account deletion (self-service, fulfills Privacy Policy / UU PDP) */}
      <Card className="mt-6 !border-danger/20" padding="sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 bg-danger/10 text-danger rounded-lg grid place-items-center shrink-0">
              <AlertTriangle size={18} />
            </div>
            <div>
              <p className="font-bold text-dark">Hapus akun permanen</p>
              <p className="text-xs text-muted leading-snug mt-0.5">
                Semua data kamu (saldo, akun Reddit, riwayat) akan dihapus selamanya. Nggak bisa dibalikin.
              </p>
            </div>
          </div>
          <button
            onClick={() => setDeleteOpen(true)}
            className="shrink-0 text-xs font-bold text-danger ring-1 ring-danger/40 hover:bg-danger hover:text-white px-3 py-2 rounded-lg transition tap-shrink"
          >
            Hapus Akun
          </button>
        </div>
      </Card>

      {/* Desktop logout (kept inline with deletion section for symmetry) */}
      <button
        onClick={handleLogout}
        className="hidden md:flex w-full mt-3 items-center justify-center gap-2 py-2 text-muted text-sm font-semibold tap-shrink"
      >
        <LogOut size={16} /> Logout
      </button>

      {/* Delete account confirmation modal (type-email-to-confirm) */}
      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
          <div className="absolute inset-0 bg-black/60" onClick={() => !deleting && setDeleteOpen(false)} />
          <div className="relative bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-2xl animate-slide-up safe-bottom">
            <div className="p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xl font-extrabold text-danger flex items-center gap-2">
                  <AlertTriangle size={22} /> Hapus Akun Permanen
                </h3>
                <button
                  onClick={() => !deleting && setDeleteOpen(false)}
                  disabled={deleting}
                  className="p-2 -mr-2 text-muted hover:text-dark disabled:opacity-50"
                >
                  <X size={22} />
                </button>
              </div>
              <div className="bg-danger/10 ring-1 ring-danger/30 rounded-xl p-3 mb-4 text-sm text-danger/90">
                <p className="font-bold mb-1">⚠️ Aksi ini nggak bisa di-undo</p>
                <p className="leading-snug">
                  Akun, saldo (termasuk yang belum dicair), akun Reddit, dan seluruh riwayat kamu akan <b>dihapus permanen</b>.
                  Kalau ada saldo yang belum ditarik, akan <b>hilang</b>. Yakin banget?
                </p>
              </div>
              <p className="text-sm text-dark mb-1.5">
                Ketik email kamu <b className="font-mono">{user?.email}</b> buat konfirmasi:
              </p>
              <input
                type="email"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={user?.email}
                className="w-full min-h-[48px] px-4 py-3 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-danger focus:bg-white transition mb-4"
                autoFocus
                disabled={deleting}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setDeleteOpen(false)}
                  disabled={deleting}
                  className="flex-1 py-3 rounded-xl font-bold text-dark bg-light hover:bg-border tap-shrink disabled:opacity-50"
                >
                  Batal
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleting || deleteConfirm.trim().toLowerCase() !== (user?.email || '').toLowerCase()}
                  className="flex-1 py-3 rounded-xl font-bold text-white bg-danger hover:brightness-110 tap-shrink disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {deleting ? 'Menghapus…' : (<><Trash2 size={16} /> Hapus Permanen</>)}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
