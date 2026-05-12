import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';
import { Check, Shield, AlertCircle, Sparkles, Lock, Zap, Gift } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { RedditLayout } from '../components/RedditLayout';
import { useTopups } from '../hooks/useTopups';
import { useRedditCredits } from '../hooks/useRedditCredits';
import { formatUSD, getB1G1Status, type B1G1Status } from '../lib/api';

const PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID || 'test';

interface Package {
  amount: number; // in dollars
  bonus: number; // bonus % (e.g. 10 = 10%)
  popular?: boolean;
  label: string;
  description: string;
}

const PACKAGES: Package[] = [
  { amount: 25, bonus: 0, label: 'Starter', description: '50 upvotes' },
  { amount: 50, bonus: 0, label: 'Growth', description: '100 upvotes' },
  { amount: 100, bonus: 0, label: 'Operator', description: '200 upvotes', popular: true },
  { amount: 250, bonus: 0, label: 'Studio', description: '500 upvotes' },
  { amount: 500, bonus: 0, label: 'Agency', description: '1,000 upvotes' },
  { amount: 1000, bonus: 0, label: 'Scale', description: '2,000 upvotes' },
];

export function RedditTopup() {
  const navigate = useNavigate();
  const { balance } = useRedditCredits();
  const { topups, completeTopup } = useTopups();
  const [selectedPkg, setSelectedPkg] = useState<Package>(PACKAGES[2]);
  const [processing, setProcessing] = useState(false);
  const [b1g1, setB1g1] = useState<B1G1Status | null>(null);

  useEffect(() => {
    let mounted = true;
    getB1G1Status()
      .then((s) => { if (mounted) setB1g1(s); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  const finalAmount = selectedPkg.amount;
  const isValidAmount = true;
  const bonus = selectedPkg.bonus;
  const baseCents = Math.round(finalAmount * 100 * (1 + bonus / 100));

  // B1G1 bonus calculation (preview — final amount comes from server)
  const b1g1BonusCents =
    b1g1 && b1g1.is_active && b1g1.user_remaining_cents > 0
      ? Math.min(finalAmount * 100, b1g1.user_remaining_cents)
      : 0;

  const totalCreditsCents = baseCents + b1g1BonusCents;

  const handlePayPalApprove = async (data: any, actions: any) => {
    setProcessing(true);
    try {
      const details = await actions.order.capture();
      const captureId = details.purchase_units?.[0]?.payments?.captures?.[0]?.id;

      // amountCents = what was actually charged via PayPal (server adds B1G1 bonus on top)
      await completeTopup({
        amountCents: Math.round(finalAmount * 100),
        paypalOrderId: data.orderID,
        paypalCaptureId: captureId || data.orderID,
      });

      const bonusMsg = b1g1BonusCents > 0 ? ` (incl. ${formatUSD(b1g1BonusCents)} Beta bonus!)` : '';
      toast.success(`${formatUSD(totalCreditsCents)} credit added${bonusMsg}`);
      // Refresh promo status — global slots may have changed
      getB1G1Status().then(setB1g1).catch(() => {});
      setTimeout(() => navigate('/reddit/dashboard'), 1500);
    } catch (err: any) {
      toast.error(err.message || 'Failed to process payment');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <RedditLayout>
      <div className="p-6 md:p-10 max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-slate-900">Top up credit</h1>
          <p className="text-slate-600 mt-1">
            Secure PayPal checkout. Credits never expire.
          </p>
        </div>

        {/* B1G1 Beta Promo Banner */}
        {b1g1 && b1g1.is_active && (
          <div className="mb-6 p-5 rounded-2xl bg-gradient-to-r from-orange-500 via-amber-500 to-orange-500 text-white shadow-lg shadow-orange-500/20 relative overflow-hidden">
            <div className="absolute -top-8 -right-8 w-40 h-40 bg-white/10 rounded-full blur-3xl" />
            <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="hidden md:flex w-12 h-12 rounded-xl bg-white/20 items-center justify-center shrink-0">
                  <Gift size={22} />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest bg-white/25 px-2 py-0.5 rounded">Beta launch</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-orange-50">Limited offer</span>
                  </div>
                  <p className="font-bold text-lg md:text-xl leading-tight">
                    🎉 Buy 1, Get 1 — every top-up matched 100%
                  </p>
                  <p className="text-xs md:text-sm text-orange-50 mt-1">
                    Up to <strong className="text-white">$100 bonus per client</strong> · {b1g1.slots_remaining}/{b1g1.max_clients} client slots left
                    {b1g1.user_bonus_cents > 0 && (
                      <> · You've claimed <strong className="text-white">{formatUSD(b1g1.user_bonus_cents)}</strong> of {formatUSD(b1g1.max_per_user_cents)}</>
                    )}
                  </p>
                </div>
              </div>
              {b1g1.user_remaining_cents > 0 && (
                <div className="md:text-right shrink-0">
                  <p className="text-[10px] uppercase tracking-wider text-orange-100 font-semibold">Your remaining bonus</p>
                  <p className="text-2xl font-bold">{formatUSD(b1g1.user_remaining_cents)}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Balance bar */}
        <div className="mb-8 p-5 rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 text-white flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-slate-400 font-semibold">Current balance</p>
            <p className="text-3xl font-bold mt-1">{formatUSD(balance)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">After this top up</p>
            <p className="text-lg font-bold text-orange-400">{formatUSD(balance + totalCreditsCents)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Packages */}
          <div className="lg:col-span-2">
            <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-4">Choose package</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {PACKAGES.map((pkg) => {
                const selected = selectedPkg.amount === pkg.amount;
                return (
                  <button
                    key={pkg.amount}
                    onClick={() => setSelectedPkg(pkg)}
                    className={`relative text-left p-5 rounded-xl border-2 transition ${
                      selected
                        ? 'border-orange-500 bg-orange-50/50 shadow-md'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                  >
                    {pkg.popular && (
                      <div className="absolute -top-2.5 left-4 px-2 py-0.5 rounded-full bg-orange-500 text-white text-[10px] font-bold uppercase tracking-wider">
                        Popular
                      </div>
                    )}
                    {pkg.bonus > 0 && (
                      <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold flex items-center gap-1">
                        <Sparkles size={10} />
                        +{pkg.bonus}%
                      </div>
                    )}
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{pkg.label}</p>
                    <div className="mt-1 flex items-baseline gap-1">
                      <span className="text-2xl font-bold text-slate-900">${pkg.amount}</span>
                      {pkg.bonus > 0 && (
                        <span className="text-xs text-emerald-600 font-semibold">
                          + ${(pkg.amount * pkg.bonus / 100).toFixed(0)} bonus
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{pkg.description}</p>
                    {selected && (
                      <div className="absolute top-3 left-3 w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center">
                        <Check size={12} className="text-white" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            <p className="mt-3 text-xs text-slate-500 text-center">
              Need a larger package or volume pricing? <a href="mailto:billing@straight.ltd" className="text-orange-600 font-semibold hover:underline">Contact sales</a>
            </p>
          </div>

          {/* Order summary + PayPal */}
          <div className="lg:col-span-1">
            <div className="sticky top-6 bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
              <div className="px-6 py-5 border-b border-slate-100">
                <h3 className="font-bold text-slate-900">Order summary</h3>
              </div>

              <div className="px-6 py-5 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">You pay</span>
                  <span className="font-semibold text-slate-900">${finalAmount.toFixed(2)}</span>
                </div>
                {b1g1BonusCents > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-orange-600 flex items-center gap-1 font-semibold">
                      <Gift size={12} />
                      Beta B1G1 bonus
                    </span>
                    <span className="font-bold text-orange-600">+{formatUSD(b1g1BonusCents)}</span>
                  </div>
                )}
                {bonus > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-emerald-600 flex items-center gap-1">
                      <Sparkles size={12} />
                      Volume bonus
                    </span>
                    <span className="font-semibold text-emerald-600">+${(finalAmount * bonus / 100).toFixed(2)}</span>
                  </div>
                )}
                <div className="pt-3 border-t border-slate-200 flex justify-between">
                  <span className="font-bold text-slate-900">Credit you receive</span>
                  <span className="text-2xl font-bold text-orange-600">
                    {formatUSD(totalCreditsCents)}
                  </span>
                </div>
              </div>

              <div className="px-6 pb-6">
                {!isValidAmount ? (
                  <div className="p-3 rounded-lg bg-rose-50 text-sm text-rose-700 flex items-start gap-2">
                    <AlertCircle size={16} className="shrink-0 mt-0.5" />
                    <span>Amount must be between $5 and $10,000</span>
                  </div>
                ) : PAYPAL_CLIENT_ID === 'test' ? (
                  <div className="p-4 rounded-lg bg-amber-50 ring-1 ring-amber-200 text-sm text-amber-900">
                    <p className="font-semibold flex items-center gap-1.5">
                      <AlertCircle size={14} />
                      PayPal not configured
                    </p>
                    <p className="text-xs mt-1 text-amber-700">
                      Add <code className="px-1 py-0.5 rounded bg-amber-100 font-mono">VITE_PAYPAL_CLIENT_ID</code> to your <code className="px-1 py-0.5 rounded bg-amber-100 font-mono">.env.local</code> to enable PayPal checkout.
                    </p>
                  </div>
                ) : (
                  <PayPalScriptProvider
                    options={{
                      'clientId': PAYPAL_CLIENT_ID,
                      currency: 'USD',
                      intent: 'capture',
                    }}
                  >
                    <PayPalButtons
                      key={finalAmount}
                      style={{
                        layout: 'vertical',
                        color: 'gold',
                        shape: 'rect',
                        label: 'paypal',
                        height: 45,
                      }}
                      disabled={processing}
                      createOrder={(_data, actions) => {
                        return actions.order.create({
                          intent: 'CAPTURE',
                          purchase_units: [
                            {
                              amount: {
                                value: finalAmount.toFixed(2),
                                currency_code: 'USD',
                              },
                              description: `Straight Ltd credit top-up: $${finalAmount.toFixed(2)}`,
                            },
                          ],
                        });
                      }}
                      onApprove={handlePayPalApprove}
                      onError={(err: any) => {
                        toast.error('PayPal error: ' + (err.message || 'Unknown'));
                      }}
                      onCancel={() => {
                        toast('Payment cancelled', { icon: '↩️' });
                      }}
                    />
                  </PayPalScriptProvider>
                )}

                {/* Trust badges */}
                <div className="mt-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <Lock size={12} className="text-emerald-600" />
                    Secure checkout · 256-bit SSL encryption
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <Shield size={12} className="text-emerald-600" />
                    Buyer Protection · 30-day refund window
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <Zap size={12} className="text-emerald-600" />
                    Credits added instantly · No waiting
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* History */}
        {topups.length > 0 && (
          <div className="mt-12">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Payment history</h2>
            <div className="bg-white rounded-2xl ring-1 ring-slate-200 overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Date</th>
                    <th className="text-left text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Method</th>
                    <th className="text-right text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Amount</th>
                    <th className="text-center text-xs font-semibold text-slate-600 uppercase tracking-wider px-6 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {topups.map((t: any) => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="px-6 py-4 text-sm text-slate-900">
                        {new Date(t.created_at).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 uppercase">
                        {t.payment_method}
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-slate-900">
                        {formatUSD(t.amount_cents)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex justify-center">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ${
                            t.payment_status === 'completed'
                              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                              : t.payment_status === 'failed'
                              ? 'bg-rose-50 text-rose-700 ring-rose-200'
                              : 'bg-amber-50 text-amber-700 ring-amber-200'
                          }`}>
                            {t.payment_status}
                          </span>
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
    </RedditLayout>
  );
}
