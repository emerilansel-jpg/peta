import { useEffect, useState } from 'react';
import { Bot, CheckCircle2, KeyRound, Loader2, Save, ShieldCheck } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { AdminBreadcrumb, AdminLayout } from '../../components/AdminLayout';
import {
  getStraightAiSettings,
  updateStraightAiSettings,
  type StraightDraftProvider,
} from '../../lib/api';

const PROVIDERS: Array<{
  id: StraightDraftProvider;
  label: string;
  description: string;
  secret: string;
}> = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'Lower-cost default for forum-comment drafts.',
    secret: 'DEEPSEEK_API_KEY',
  },
  {
    id: 'claude',
    label: 'Claude',
    description: 'Anthropic Messages API for higher-quality editorial drafts.',
    secret: 'ANTHROPIC_API_KEY',
  },
];

export function AdminSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState<StraightDraftProvider>('deepseek');
  const [claudeModel, setClaudeModel] = useState('claude-sonnet-4-20250514');
  const [deepseekModel, setDeepseekModel] = useState('deepseek-chat');
  const [updatedAt, setUpdatedAt] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const settings = await getStraightAiSettings();
        setProvider(settings.draft_provider);
        setClaudeModel(settings.claude_model);
        setDeepseekModel(settings.deepseek_model);
        setUpdatedAt(settings.updated_at);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await updateStraightAiSettings({
        draftProvider: provider,
        claudeModel: claudeModel.trim(),
        deepseekModel: deepseekModel.trim(),
      });
      toast.success('Draft provider updated');
      const next = await getStraightAiSettings();
      setUpdatedAt(next.updated_at);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout>
      <div className="p-6 md:p-10 max-w-5xl mx-auto">
        <AdminBreadcrumb items={[{ label: 'Admin', href: '/reddit/admin' }, { label: 'Settings' }]} />

        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 text-orange-600 mb-2">
              <Bot size={20} />
              <p className="text-xs uppercase tracking-widest font-bold">Draft Engine</p>
            </div>
            <h1 className="text-3xl font-bold text-slate-900">AI Provider Settings</h1>
            <p className="text-slate-600 mt-2 max-w-2xl">
              Choose which server-side model prepares suggested forum-comment drafts. Clients never see the provider name.
            </p>
          </div>
          <button
            onClick={save}
            disabled={loading || saving}
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-500 text-white font-semibold"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save settings
          </button>
        </div>

        {loading ? (
          <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-8 text-slate-600">
            Loading settings...
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PROVIDERS.map((item) => {
                const active = provider === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setProvider(item.id)}
                    className={`text-left rounded-2xl border-2 p-5 transition ${
                      active ? 'border-orange-500 bg-orange-50' : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-bold text-slate-900">{item.label}</p>
                        <p className="text-sm text-slate-600 mt-1 leading-relaxed">{item.description}</p>
                      </div>
                      {active && <CheckCircle2 size={22} className="text-orange-600 shrink-0" />}
                    </div>
                    <div className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-slate-600 bg-white/80 ring-1 ring-slate-200 px-2.5 py-1 rounded-full">
                      <KeyRound size={12} />
                      Requires {item.secret}
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <ShieldCheck size={18} className="text-emerald-600" />
                <h2 className="text-lg font-bold text-slate-900">Model IDs</h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">Claude model</span>
                  <input
                    value={claudeModel}
                    onChange={(event) => setClaudeModel(event.target.value)}
                    className="mt-2 w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                    placeholder="claude-sonnet-4-20250514"
                  />
                </label>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">DeepSeek model</span>
                  <input
                    value={deepseekModel}
                    onChange={(event) => setDeepseekModel(event.target.value)}
                    className="mt-2 w-full px-4 py-3 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900"
                    placeholder="deepseek-chat"
                  />
                </label>
              </div>
              <p className="text-xs text-slate-500 mt-4">
                API keys are stored only as Supabase Edge Function secrets. This page stores provider and model selection only.
                {updatedAt ? ` Last updated ${new Date(updatedAt).toLocaleString()}.` : ''}
              </p>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
