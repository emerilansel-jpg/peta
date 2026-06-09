import { useEffect, useState } from 'react';
import { AlertTriangle, Bot, CheckCircle2, DoorOpen, ExternalLink, KeyRound, ListChecks, Loader2, RefreshCw, Save, ShieldCheck, UserPlus } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { AdminBreadcrumb, AdminLayout } from '../../components/AdminLayout';
import {
  getStraightAiSettings,
  getStraightProviderHealth,
  updateStraightAiSettings,
  getFrontDoorMode,
  adminSetFrontDoorMode,
  type ProviderHealthStatus,
  type StraightProviderHealth,
  type StraightDraftProvider,
  type FrontDoorMode,
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
  const [health, setHealth] = useState<StraightProviderHealth | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [frontDoorMode, setFrontDoorMode] = useState<FrontDoorMode>('signup');
  const [savingFrontDoor, setSavingFrontDoor] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const settings = await getStraightAiSettings();
        setProvider(settings.draft_provider);
        setClaudeModel(settings.claude_model);
        setDeepseekModel(settings.deepseek_model);
        setUpdatedAt(settings.updated_at);
        setFrontDoorMode(await getFrontDoorMode());
        checkHealth();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const checkHealth = async () => {
    setCheckingHealth(true);
    try {
      setHealth(await getStraightProviderHealth());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to check provider health');
    } finally {
      setCheckingHealth(false);
    }
  };

  const saveFrontDoor = async (mode: FrontDoorMode) => {
    const prev = frontDoorMode;
    setFrontDoorMode(mode); // optimistic
    setSavingFrontDoor(true);
    try {
      await adminSetFrontDoorMode(mode);
      toast.success(mode === 'waitlist'
        ? 'Front door set to Waitlist — new visitors join the waitlist.'
        : 'Front door set to Open signup.');
    } catch (error) {
      setFrontDoorMode(prev); // revert
      toast.error(error instanceof Error ? error.message : 'Failed to update front door');
    } finally {
      setSavingFrontDoor(false);
    }
  };

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
            <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6">
              <div className="flex items-center gap-2 mb-1">
                <DoorOpen size={18} className="text-orange-600" />
                <h2 className="text-lg font-bold text-slate-900">Front door — who can join</h2>
              </div>
              <p className="text-sm text-slate-500 mb-4">
                Controls the public landing CTA. Switch to <strong>Waitlist only</strong> to throttle new clients —
                the primary buttons route to the waitlist instead of open signup. Saved instantly.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => saveFrontDoor('signup')}
                  disabled={savingFrontDoor}
                  className={`text-left rounded-2xl border-2 p-5 transition disabled:opacity-60 ${
                    frontDoorMode === 'signup' ? 'border-orange-500 bg-orange-50' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <UserPlus size={18} className="text-slate-700" />
                        <p className="text-lg font-bold text-slate-900">Open signup</p>
                      </div>
                      <p className="text-sm text-slate-600 mt-1 leading-relaxed">Anyone can create an account and order right away.</p>
                    </div>
                    {frontDoorMode === 'signup' && <CheckCircle2 size={22} className="text-orange-600 shrink-0" />}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => saveFrontDoor('waitlist')}
                  disabled={savingFrontDoor}
                  className={`text-left rounded-2xl border-2 p-5 transition disabled:opacity-60 ${
                    frontDoorMode === 'waitlist' ? 'border-orange-500 bg-orange-50' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <ListChecks size={18} className="text-slate-700" />
                        <p className="text-lg font-bold text-slate-900">Waitlist only</p>
                      </div>
                      <p className="text-sm text-slate-600 mt-1 leading-relaxed">New visitors join a waitlist. Existing clients can still sign in.</p>
                    </div>
                    {frontDoorMode === 'waitlist' && <CheckCircle2 size={22} className="text-orange-600 shrink-0" />}
                  </div>
                </button>
              </div>
            </div>

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

            <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={18} className="text-blue-600" />
                    <h2 className="text-lg font-bold text-slate-900">Provider Health</h2>
                  </div>
                  <p className="text-sm text-slate-500 mt-1">
                    Checks server-side secrets and live access without showing any key values.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={checkHealth}
                  disabled={checkingHealth}
                  className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:bg-slate-200 disabled:text-slate-500 text-white text-sm font-semibold"
                >
                  {checkingHealth ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                  Recheck
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <HealthCard
                  label="DeepSeek drafts"
                  status={health?.deepseek.status}
                  detail={health?.deepseek.detail}
                  hint="Ready for suggested forum-comment drafts."
                />
                <HealthCard
                  label="Claude drafts"
                  status={health?.claude.status}
                  detail={health?.claude.detail}
                  hint="Add ANTHROPIC_API_KEY to Supabase secrets before choosing Claude."
                  actionLabel="Open Anthropic keys"
                  actionUrl="https://console.anthropic.com/settings/keys"
                />
                <HealthCard
                  label="DataForSEO keyword data"
                  status={health?.dataforseo.status}
                  detail={health?.dataforseo.detail}
                  hint="Top up DataForSEO until the balance is positive, then click Recheck."
                  actionLabel="Open DataForSEO"
                  actionUrl="https://app.dataforseo.com"
                />
                <HealthCard
                  label="Google Custom Search SERP"
                  status={health?.google.status}
                  detail={health?.google.detail}
                  hint="Check Google Custom Search API access, CSE ID, API restrictions, and billing."
                  actionLabel="Open Google API"
                  actionUrl="https://console.cloud.google.com/apis/api/customsearch.googleapis.com"
                />
                <HealthCard
                  label="SerpAPI Google SERP"
                  status={health?.serpapi.status}
                  detail={health?.serpapi.detail}
                  hint="Optional fallback: add SERPAPI_API_KEY to Supabase secrets if Google CSE stays blocked."
                  actionLabel="Open SerpAPI"
                  actionUrl="https://serpapi.com/dashboard"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}

function HealthCard({
  label,
  status,
  detail,
  hint,
  actionLabel,
  actionUrl,
}: {
  label: string;
  status?: ProviderHealthStatus;
  detail?: string;
  hint?: string;
  actionLabel?: string;
  actionUrl?: string;
}) {
  const normalized = status || 'missing';
  const isOk = normalized === 'ok';
  const isMissing = normalized === 'missing';
  return (
    <div className={`rounded-xl ring-1 p-4 ${
      isOk ? 'bg-emerald-50 ring-emerald-100' : isMissing ? 'bg-slate-50 ring-slate-200' : 'bg-rose-50 ring-rose-100'
    }`}>
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-lg grid place-items-center shrink-0 ${
          isOk ? 'bg-emerald-100 text-emerald-700' : isMissing ? 'bg-slate-200 text-slate-600' : 'bg-rose-100 text-rose-700'
        }`}>
          {isOk ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
        </div>
        <div className="min-w-0">
          <p className="font-bold text-slate-900">{label}</p>
          <p className={`text-xs font-bold uppercase tracking-wide mt-1 ${
            isOk ? 'text-emerald-700' : isMissing ? 'text-slate-500' : 'text-rose-700'
          }`}>
            {normalized}
          </p>
          {detail && <p className="text-xs text-slate-600 mt-1 break-words">{detail}</p>}
          {!isOk && hint && (
            <p className="text-xs text-slate-700 mt-2 rounded-lg bg-white/70 ring-1 ring-slate-200 px-2 py-1.5">
              {hint}
            </p>
          )}
          {!isOk && actionUrl && actionLabel && (
            <a
              href={actionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-slate-800 hover:text-orange-600"
            >
              {actionLabel}
              <ExternalLink size={12} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
