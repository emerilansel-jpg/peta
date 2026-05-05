import React from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Plus, X, Pencil, Trash2, MessageCircle, Mail, Power } from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { CardSkeleton } from '../../components/Skeleton';
import { supabase } from '../../lib/supabase';
import { toast } from '../../components/Toast';

type Member = {
  id: string;
  email: string;
  full_name: string | null;
  whatsapp: string | null;
  is_active: boolean;
  created_at: string;
  reddit_accounts?: { username: string; karma: number; level: number }[];
};

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('id-ID', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

export function AdminTeam() {
  const [showSheet, setShowSheet] = React.useState(false);
  const [editingMember, setEditingMember] = React.useState<Member | null>(null);

  const { data: users = [], isLoading, refetch } = useQuery<Member[]>({
    queryKey: ['armyUsers'],
    queryFn: async () => {
      const { data } = await supabase
        .from('users')
        .select('*, reddit_accounts(username, karma, level)')
        .eq('role', 'army')
        .order('created_at', { ascending: false });
      return (data as Member[]) || [];
    },
  });

  return (
    <Layout userRole="admin">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-xs uppercase tracking-wide font-bold text-muted">Admin Console</p>
          <h1 className="text-2xl sm:text-3xl font-extrabold">Tim Army</h1>
          <p className="text-sm text-muted">{users.length} member terdaftar</p>
        </div>
        <Button onClick={() => { setEditingMember(null); setShowSheet(true); }} variant="primary" size="md">
          <Plus size={18} /> Tambah
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3"><CardSkeleton /><CardSkeleton /></div>
      ) : users.length === 0 ? (
        <Card className="text-center py-10">
          <div className="text-5xl mb-3">👥</div>
          <p className="font-bold">Belum ada army member</p>
        </Card>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {users.map((u) => (
              <MemberCard
                key={u.id}
                member={u}
                onEdit={() => { setEditingMember(u); setShowSheet(true); }}
                onRefetch={refetch}
              />
            ))}
          </div>

          {/* Desktop table */}
          <Card className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="px-2 py-2 font-semibold text-muted">Member</th>
                  <th className="px-2 py-2 font-semibold text-muted">Email</th>
                  <th className="px-2 py-2 font-semibold text-muted">WhatsApp</th>
                  <th className="px-2 py-2 font-semibold text-muted">Akun Reddit</th>
                  <th className="px-2 py-2 font-semibold text-muted">Karma</th>
                  <th className="px-2 py-2 font-semibold text-muted">Status</th>
                  <th className="px-2 py-2 font-semibold text-muted">Joined</th>
                  <th className="px-2 py-2 font-semibold text-muted text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const acc = u.reddit_accounts?.[0];
                  return (
                    <tr key={u.id} className="border-b border-border last:border-0 hover:bg-light">
                      <td className="px-2 py-3 font-semibold">{u.full_name || u.email.split('@')[0]}</td>
                      <td className="px-2 py-3 text-muted">{u.email}</td>
                      <td className="px-2 py-3">
                        {u.whatsapp ? (
                          <a
                            href={`https://wa.me/${u.whatsapp}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-success font-semibold hover:underline"
                          >
                            {u.whatsapp}
                          </a>
                        ) : '–'}
                      </td>
                      <td className="px-2 py-3">{acc ? `u/${acc.username}` : '–'}</td>
                      <td className="px-2 py-3 money">{acc?.karma ?? '–'}</td>
                      <td className="px-2 py-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          u.is_active ? 'bg-success/15 text-success' : 'bg-muted/15 text-muted'
                        }`}>
                          {u.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-2 py-3 text-muted whitespace-nowrap">{formatDateTime(u.created_at)}</td>
                      <td className="px-2 py-3 text-right">
                        <RowActions member={u} onEdit={() => { setEditingMember(u); setShowSheet(true); }} onRefetch={refetch} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {showSheet && (
        <MemberSheet
          member={editingMember}
          onClose={() => setShowSheet(false)}
          onSaved={() => { setShowSheet(false); refetch(); }}
        />
      )}
    </Layout>
  );
}

function MemberCard({ member, onEdit, onRefetch }: { member: Member; onEdit: () => void; onRefetch: () => void }) {
  const acc = member.reddit_accounts?.[0];
  return (
    <Card padding="sm">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0 flex-1">
          <p className="font-bold truncate">{member.full_name || member.email.split('@')[0]}</p>
          <p className="text-xs text-muted truncate">{member.email}</p>
          {member.whatsapp && (
            <a
              href={`https://wa.me/${member.whatsapp}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-success font-semibold mt-1 hover:underline"
            >
              <MessageCircle size={11} /> {member.whatsapp}
            </a>
          )}
          {acc && (
            <p className="text-xs mt-1.5">
              <span className="text-primary font-semibold">u/{acc.username}</span>
              <span className="text-muted"> • karma {acc.karma}</span>
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
            member.is_active ? 'bg-success/15 text-success' : 'bg-muted/15 text-muted'
          }`}>
            {member.is_active ? 'Active' : 'Inactive'}
          </span>
          <span className="text-[10px] text-muted text-right">{formatDateTime(member.created_at)}</span>
        </div>
      </div>
      <div className="flex justify-end">
        <RowActions member={member} onEdit={onEdit} onRefetch={onRefetch} />
      </div>
    </Card>
  );
}

function RowActions({ member, onEdit, onRefetch }: { member: Member; onEdit: () => void; onRefetch: () => void }) {
  const toggleActive = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('admin_update_member', {
        p_user_id: member.id,
        p_is_active: !member.is_active,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Status diupdate'); onRefetch(); },
    onError: (e: any) => toast.error(e.message || 'Gagal'),
  });

  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('admin_delete_member', { p_user_id: member.id });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Member dihapus'); onRefetch(); },
    onError: (e: any) => toast.error(e.message || 'Gagal hapus'),
  });

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={onEdit}
        className="tap-shrink p-2 text-primary hover:bg-primary/10 rounded-lg"
        aria-label="Edit"
      >
        <Pencil size={16} />
      </button>
      <button
        onClick={() => toggleActive.mutate()}
        className={`tap-shrink p-2 rounded-lg ${member.is_active ? 'text-warning hover:bg-warning/10' : 'text-success hover:bg-success/10'}`}
        aria-label={member.is_active ? 'Nonaktifkan' : 'Aktifkan'}
        disabled={toggleActive.isPending}
      >
        <Power size={16} />
      </button>
      <button
        onClick={() => {
          if (confirm(`Hapus ${member.email}? Tidak bisa di-undo.`)) del.mutate();
        }}
        className="tap-shrink p-2 text-danger hover:bg-danger/10 rounded-lg"
        aria-label="Hapus"
        disabled={del.isPending}
      >
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function MemberSheet({ member, onClose, onSaved }: {
  member: Member | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!member;
  const [email, setEmail] = React.useState(member?.email || '');
  const [password, setPassword] = React.useState('');
  const [fullName, setFullName] = React.useState(member?.full_name || '');
  const [whatsapp, setWhatsapp] = React.useState(member?.whatsapp || '');

  const save = useMutation({
    mutationFn: async () => {
      const cleanedWa = whatsapp.replace(/\D/g, '').replace(/^0/, '62') || null;
      if (isEdit) {
        const { error } = await supabase.rpc('admin_update_member', {
          p_user_id: member!.id,
          p_full_name: fullName || null,
          p_whatsapp: cleanedWa,
        });
        if (error) throw error;
      } else {
        if (password.length < 6) throw new Error('Password minimal 6 karakter');
        const { error } = await supabase.rpc('admin_create_member', {
          p_email: email,
          p_password: password,
          p_whatsapp: cleanedWa,
          p_full_name: fullName || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success(isEdit ? 'Tersimpan ✅' : 'Member dibuat ✅'); onSaved(); },
    onError: (e: any) => toast.error(e.message || 'Gagal menyimpan'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md max-h-[90dvh] overflow-y-auto sm:rounded-3xl rounded-t-3xl shadow-2xl animate-slide-up safe-bottom">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-extrabold">{isEdit ? 'Edit Member' : 'Tambah Member'}</h3>
            <button onClick={onClose} className="p-2 -mr-2 text-muted hover:text-dark">
              <X size={22} />
            </button>
          </div>

          <div className="space-y-3">
            <Field label="Nama">
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nama lengkap"
                className={inputCls}
              />
            </Field>

            <Field label="Email" icon={<Mail size={12} />}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isEdit}
                className={inputCls + (isEdit ? ' opacity-60 cursor-not-allowed' : '')}
              />
            </Field>

            {!isEdit && (
              <Field label="Password (min 6 karakter)">
                <input
                  type="text"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Kirim ke member nanti"
                  className={inputCls}
                />
              </Field>
            )}

            <Field label="WhatsApp" icon={<MessageCircle size={12} />}>
              <input
                type="tel"
                inputMode="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder="08xxxxxxxxxx"
                className={inputCls}
              />
            </Field>

            <Button
              onClick={() => save.mutate()}
              variant="primary"
              size="lg"
              loading={save.isPending}
              fullWidth
              disabled={!isEdit && (!email || password.length < 6)}
            >
              {isEdit ? 'Simpan Perubahan' : 'Buat Member'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  'w-full min-h-[44px] px-4 py-2.5 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition';

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-bold text-dark mb-1.5 uppercase tracking-wide flex items-center gap-1">
        {icon} {label}
      </label>
      {children}
    </div>
  );
}
