import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Key, Plus, Trash2, X, Eye, EyeOff, Save, AlertCircle, ExternalLink,
  Shield, Check, Info,
} from 'lucide-react';
import { Layout } from '../../components/Layout';
import { Card } from '../../components/Card';
import { Button } from '../../components/Button';
import { supabase } from '../../lib/supabase';
import { toast } from '../../components/Toast';

type SecretRow = {
  key: string;
  value_preview: string;
  value_length: number;
  updated_at: string;
};

// Known secret keys + human descriptions. Helps admin understand what each
// key does without diving into code. Anything not in this catalog is shown
// as "Custom secret" — still fully editable.
const KNOWN_SECRETS: Record<string, { label: string; description: string; setupUrl?: string; }> = {
  REDDIT_CLIENT_ID: {
    label: 'Reddit API — Client ID',
    description: 'Required for karma sync. Reddit blocks datacenter IPs on public endpoints. OAuth via installed-app bypasses this. Register at reddit.com/prefs/apps → "create another app" → installed app type. Copy the 14-char ID shown below your app name.',
    setupUrl: 'https://www.reddit.com/prefs/apps',
  },
  REDDIT_USER_AGENT: {
    label: 'Reddit API — User Agent',
    description: 'Required by Reddit Terms of Service. Format: "AppName/Version by /u/RedditUsername". Example: PeTaApp/1.0 by /u/petaapp',
  },
  FONNTE_TOKEN: {
    label: 'Fonnte — Device Token',
    description: 'WhatsApp gateway token from fonnte.com → Device → Token. Used for sending broadcasts + inbox replies.',
    setupUrl: 'https://md.fonnte.com/new/device.php',
  },
  SMTP_HOST: {
    label: 'Email SMTP — Host',
    description: 'Spacemail SMTP host. Default: mail.spacemail.com',
  },
  SMTP_PORT: {
    label: 'Email SMTP — Port',
    description: 'Port for SMTP. 465 for SSL, 587 for STARTTLS. Default: 465',
  },
  SMTP_USER: {
    label: 'Email SMTP — Username',
    description: 'Email address used as login. Example: peta@penghasilantambahan.com',
  },
  SMTP_PASS: {
    label: 'Email SMTP — Password',
    description: 'Mailbox password from Spacemail. Rotate via SQL when needed.',
    setupUrl: 'https://www.spaceship.com/dashboard/email',
  },
  BROADCAST_FROM: {
    label: 'Email — From Address',
    description: 'Display name + email for outgoing broadcasts. Format: "PeTa <peta@penghasilantambahan.com>"',
  },
  RESEND_API_KEY: {
    label: 'Resend API Key (optional)',
    description: 'If set, broadcasts use Resend.com API instead of SMTP. Leave blank to use SMTP.',
    setupUrl: 'https://resend.com/api-keys',
  },
};

const SUGGESTED_NEW_KEYS = [
  'REDDIT_CLIENT_ID',
  'REDDIT_USER_AGENT',
  'FONNTE_TOKEN',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'BROADCAST_FROM',
  'RESEND_API_KEY',
];

function formatRel(iso: string): string {
  const d = new Date(iso);
  const diffMin = Math.round((Date.now() - d.getTime()) / 60_000);
  if (diffMin < 1) return 'baru aja';
  if (diffMin < 60) return `${diffMin}m`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `${diffH}h`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 7) return `${diffD}d`;
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function AdminSecrets() {
  const queryClient = useQueryClient();
  const [editingKey, setEditingKey] = React.useState<string | null>(null);
  const [showAddModal, setShowAddModal] = React.useState(false);

  const secretsQuery = useQuery({
    queryKey: ['admin-secrets'],
    queryFn: async (): Promise<SecretRow[]> => {
      const { data, error } = await supabase.rpc('admin_list_secrets');
      if (error) throw error;
      return (data || []) as SecretRow[];
    },
  });

  const secrets = secretsQuery.data || [];
  const existingKeys = new Set(secrets.map((s) => s.key));
  // Suggest keys that aren't set yet
  const unsetSuggestions = SUGGESTED_NEW_KEYS.filter((k) => !existingKeys.has(k));

  const deleteMutation = useMutation({
    mutationFn: async (key: string) => {
      const { error } = await supabase.rpc('admin_delete_secret', { p_key: key });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Dihapus');
      queryClient.invalidateQueries({ queryKey: ['admin-secrets'] });
    },
    onError: (e: any) => toast.error(`Gagal hapus: ${e.message || e}`),
  });

  return (
    <Layout userRole="admin">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Key size={22} className="text-primary" />
            <h1 className="text-xl md:text-2xl font-extrabold">App Secrets</h1>
          </div>
          <Button onClick={() => setShowAddModal(true)} variant="primary" size="sm">
            <Plus size={14} /> Tambah Secret
          </Button>
        </div>
        <p className="text-sm text-muted mb-4">
          Credential rahasia (Reddit API, SMTP, Fonnte, dll). Hanya admin yang
          bisa baca/edit. Disimpan di tabel <code className="bg-light px-1 rounded">app_secrets</code> dengan RLS.
        </p>

        {/* Setup banner — points to Reddit app if karma sync isn't configured */}
        {!existingKeys.has('REDDIT_CLIENT_ID') && (
          <Card className="mb-4 bg-warning/10 ring-warning/40" padding="md">
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-warning shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-extrabold text-warning">Karma sync belum nyala</p>
                <p className="text-sm text-warning/85 mt-1 leading-relaxed">
                  Reddit blok IP datacenter untuk endpoint publik. Fix: register installed-app
                  Reddit, copy <b>Client ID</b>, paste sebagai secret <code className="bg-white/50 px-1 rounded">REDDIT_CLIENT_ID</code>.
                </p>
                <a
                  href="https://www.reddit.com/prefs/apps"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-2 text-sm font-bold text-warning hover:underline"
                >
                  <ExternalLink size={12} /> Buka Reddit Apps → klik "create another app"
                </a>
                <ol className="text-xs text-warning/80 list-decimal list-inside mt-2 space-y-0.5">
                  <li>Login ke reddit.com (akun apa aja)</li>
                  <li>Buka link di atas → "create another app"</li>
                  <li>Type: <b>installed app</b>, name: <code>PeTa Karma Sync</code>, redirect URI: <code>https://penghasilantambahan.com</code></li>
                  <li>Copy 14-char Client ID (di bawah app name)</li>
                  <li>Tambahin sebagai secret di sini dengan key <code className="bg-white/50 px-1 rounded">REDDIT_CLIENT_ID</code></li>
                </ol>
              </div>
            </div>
          </Card>
        )}

        {/* Suggested unset secrets */}
        {unsetSuggestions.length > 0 && (
          <Card className="mb-3" padding="sm">
            <p className="text-xs uppercase font-bold tracking-wide text-muted mb-2 flex items-center gap-1.5">
              <Info size={12} /> Suggested — belum diset
            </p>
            <div className="flex flex-wrap gap-1.5">
              {unsetSuggestions.map((k) => (
                <button
                  key={k}
                  onClick={() => {
                    setEditingKey(k);
                  }}
                  className="text-xs font-semibold bg-light hover:bg-primary/10 text-dark hover:text-primary px-2 py-1 rounded-full tap-shrink ring-1 ring-black/5"
                >
                  + {k}
                </button>
              ))}
            </div>
          </Card>
        )}

        {/* Existing secrets list */}
        {secretsQuery.isLoading ? (
          <Card><p className="text-sm text-muted">Loading…</p></Card>
        ) : secrets.length === 0 && unsetSuggestions.length === 0 ? (
          <Card className="text-center py-8">
            <Key size={32} className="mx-auto text-muted/40 mb-2" />
            <p className="text-sm text-muted">Belum ada secret tersimpan.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {secrets.map((s) => (
              <SecretRow
                key={s.key}
                secret={s}
                meta={KNOWN_SECRETS[s.key]}
                onEdit={() => setEditingKey(s.key)}
                onDelete={() => {
                  if (confirm(`Hapus secret "${s.key}"? Edge functions yang pakai bakal langsung berhenti jalan.`)) {
                    deleteMutation.mutate(s.key);
                  }
                }}
                deleting={deleteMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* Edit / create modal */}
      {(editingKey !== null || showAddModal) && (
        <SecretEditorModal
          editingKey={editingKey}
          existingKey={editingKey ? secrets.find((s) => s.key === editingKey) : null}
          existingKeys={existingKeys}
          onClose={() => { setEditingKey(null); setShowAddModal(false); }}
          onSaved={() => {
            setEditingKey(null);
            setShowAddModal(false);
            queryClient.invalidateQueries({ queryKey: ['admin-secrets'] });
          }}
        />
      )}
    </Layout>
  );
}

function SecretRow({ secret, meta, onEdit, onDelete, deleting }: {
  secret: SecretRow;
  meta: { label: string; description: string; setupUrl?: string } | undefined;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <Card padding="sm" className="hover:ring-primary/20 transition">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <code className="text-xs font-bold bg-light px-1.5 py-0.5 rounded">{secret.key}</code>
            <span className="text-[10px] uppercase font-bold tracking-wide text-muted">
              {secret.value_length} chars
            </span>
            <span className="text-[10px] text-muted">
              · updated {formatRel(secret.updated_at)}
            </span>
          </div>
          {meta && (
            <p className="text-xs font-bold text-dark mt-1">{meta.label}</p>
          )}
          <p className="text-xs text-muted mt-0.5 leading-snug line-clamp-2">
            {meta?.description || 'Custom secret.'}
          </p>
          <p className="text-xs text-muted mt-1 font-mono">{secret.value_preview}</p>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="p-1.5 text-primary hover:bg-primary/10 rounded-lg tap-shrink"
            title="Edit"
          >
            <Save size={14} />
          </button>
          <button
            onClick={onDelete}
            disabled={deleting}
            className="p-1.5 text-danger hover:bg-danger/10 rounded-lg tap-shrink disabled:opacity-50"
            title="Hapus"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </Card>
  );
}

function SecretEditorModal({ editingKey, existingKey, existingKeys, onClose, onSaved }: {
  editingKey: string | null;
  existingKey: SecretRow | null | undefined;
  existingKeys: Set<string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [keyInput, setKeyInput] = React.useState(editingKey || '');
  const [valueInput, setValueInput] = React.useState('');
  const [showValue, setShowValue] = React.useState(false);

  const isExisting = editingKey !== null && existingKey != null;
  const meta = KNOWN_SECRETS[keyInput];

  const saveMutation = useMutation({
    mutationFn: async () => {
      const cleanKey = keyInput.trim().toUpperCase();
      if (!cleanKey) throw new Error('Key required');
      if (!valueInput.trim()) throw new Error('Value required');
      if (!isExisting && existingKeys.has(cleanKey)) {
        throw new Error(`Key "${cleanKey}" sudah ada. Edit yang ada.`);
      }
      const { error } = await supabase.rpc('admin_set_secret', {
        p_key: cleanKey,
        p_value: valueInput.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(isExisting ? 'Updated' : 'Tersimpan');
      onSaved();
    },
    onError: (e: any) => toast.error(`Gagal: ${e.message || e}`),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-2xl animate-slide-up safe-bottom max-h-[90vh] overflow-y-auto">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-extrabold flex items-center gap-2">
              <Shield size={18} className="text-primary" />
              {isExisting ? 'Edit Secret' : 'Tambah Secret'}
            </h3>
            <button onClick={onClose} className="p-2 -mr-2 text-muted hover:text-dark">
              <X size={22} />
            </button>
          </div>

          <p className="text-xs uppercase font-bold tracking-wide text-muted mb-1">Key</p>
          <input
            type="text"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value.toUpperCase())}
            placeholder="REDDIT_CLIENT_ID"
            disabled={isExisting}
            className="w-full px-3 py-2.5 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-primary focus:bg-white transition font-mono text-sm mb-1 disabled:opacity-60 disabled:cursor-not-allowed"
          />
          {!isExisting && (
            <p className="text-[10px] text-muted mb-3">UPPER_SNAKE_CASE. Auto-uppercased.</p>
          )}

          {meta && (
            <div className="bg-primary/5 ring-1 ring-primary/20 rounded-lg p-2.5 mb-3">
              <p className="text-xs font-bold text-primary">{meta.label}</p>
              <p className="text-xs text-dark/80 mt-0.5 leading-relaxed">{meta.description}</p>
              {meta.setupUrl && (
                <a
                  href={meta.setupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-1.5 text-xs font-bold text-primary hover:underline"
                >
                  <ExternalLink size={10} /> Setup link
                </a>
              )}
            </div>
          )}

          <p className="text-xs uppercase font-bold tracking-wide text-muted mb-1">
            {isExisting ? 'New value' : 'Value'}
          </p>
          {isExisting && existingKey && (
            <p className="text-[11px] text-muted mb-1">
              Current: <code className="bg-light px-1 rounded">{existingKey.value_preview}</code> ({existingKey.value_length} chars)
            </p>
          )}
          <div className="relative mb-3">
            <input
              type={showValue ? 'text' : 'password'}
              value={valueInput}
              onChange={(e) => setValueInput(e.target.value)}
              placeholder="paste value here…"
              className="w-full px-3 py-2.5 pr-10 bg-light rounded-xl border-2 border-transparent focus:outline-none focus:border-primary focus:bg-white transition font-mono text-sm"
              autoFocus={!isExisting}
            />
            <button
              type="button"
              onClick={() => setShowValue((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-muted hover:text-dark"
              aria-label={showValue ? 'Hide' : 'Show'}
            >
              {showValue ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <Button
            onClick={() => saveMutation.mutate()}
            loading={saveMutation.isPending}
            variant="primary"
            size="lg"
            fullWidth
            disabled={!keyInput.trim() || !valueInput.trim()}
          >
            <Check size={16} /> {isExisting ? 'Update Secret' : 'Save Secret'}
          </Button>

          <p className="text-[10px] text-muted mt-2 text-center">
            Disimpan terenkripsi-at-rest di Postgres. Hanya admin yang bisa baca.
          </p>
        </div>
      </div>
    </div>
  );
}
