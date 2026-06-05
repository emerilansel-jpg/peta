import { useEffect, useState } from 'react';
import { DollarSign, Loader2, Save } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { adminSetStraightPricing, getStraightPricing, type StraightPricingRow } from '../lib/api';

// Admin-configurable service pricing matrix (price + on/off per service).
// Self-contained: loads + saves its own data so it can be dropped into any
// admin page. Lives under Finance (pricing is a revenue lever).
export function ServicePricingCard() {
  const [pricing, setPricing] = useState<StraightPricingRow[]>([]);
  const [savingPricing, setSavingPricing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setPricing(await getStraightPricing());
      } catch { /* pricing table may not exist yet */ }
    })();
  }, []);

  const setRow = (key: string, patch: Partial<StraightPricingRow>) => {
    setPricing((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const savePricing = async () => {
    setSavingPricing(true);
    try {
      for (const row of pricing) {
        await adminSetStraightPricing(row.key, Math.round(row.price_cents), row.enabled);
      }
      toast.success('Pricing saved');
      setPricing(await getStraightPricing());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save pricing');
    } finally {
      setSavingPricing(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl ring-1 ring-slate-200 p-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <DollarSign size={18} className="text-emerald-600" />
            <h2 className="text-lg font-bold text-slate-900">Service Pricing</h2>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Set the price and turn each service on/off. Services turned OFF are hidden from clients.
          </p>
        </div>
        <button
          type="button"
          onClick={savePricing}
          disabled={savingPricing || !pricing.length}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-500 text-white text-sm font-semibold"
        >
          {savingPricing ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          Save pricing
        </button>
      </div>

      {!pricing.length ? (
        <p className="text-sm text-slate-500">Pricing table not found yet — run the <code className="text-xs">straight_pricing</code> migration, then refresh.</p>
      ) : (
        <div className="space-y-5">
          {(['reddit', 'forum'] as const).map((platform) => (
            <div key={platform}>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
                {platform === 'reddit' ? 'Reddit' : 'Other forums'}
              </p>
              <div className="space-y-2">
                {pricing.filter((r) => r.platform === platform).map((row) => (
                  <div key={row.key} className="flex items-center gap-3 rounded-xl ring-1 ring-slate-200 p-3">
                    <span className="flex-1 text-sm font-medium text-slate-800">{row.label}</span>
                    <div className="relative w-28 shrink-0">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={(row.price_cents / 100).toString()}
                        onChange={(e) => setRow(row.key, { price_cents: Math.max(0, Math.round((parseFloat(e.target.value) || 0) * 100)) })}
                        className="w-full pl-6 pr-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-500 text-slate-900 text-sm"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setRow(row.key, { enabled: !row.enabled })}
                      className={`shrink-0 w-20 px-3 py-2 rounded-lg text-xs font-bold transition ${
                        row.enabled ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {row.enabled ? 'ON' : 'OFF'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
