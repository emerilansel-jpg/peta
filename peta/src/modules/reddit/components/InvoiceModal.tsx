import { useState } from 'react';
import { Printer, X, CheckCircle2 } from 'lucide-react';
import { formatUSD } from '../lib/api';

interface InvoiceModalProps {
  order: {
    id: number;
    created_at: string;
    cost_credits: number;
    requested_upvotes: number;
    thread_url: string;
    target_type?: string | null;
    subreddit?: string | null;
  };
  serviceName: string;
  client: {
    email: string;
    fullName?: string;
  };
  onClose: () => void;
}

export function InvoiceModal({ order, serviceName, client, onClose }: InvoiceModalProps) {
  const [companyName, setCompanyName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [editingDetails, setEditingDetails] = useState(false);

  const dateFormatted = new Date(order.created_at).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const invoiceNumber = `INV-STR-${String(order.id).padStart(6, '0')}`;
  const unitPriceCents = order.requested_upvotes > 0
    ? Math.round(order.cost_credits / order.requested_upvotes)
    : order.cost_credits;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #printable-invoice, #printable-invoice * {
            visibility: visible;
          }
          #printable-invoice {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 24px;
            box-shadow: none;
            border: none;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-8 overflow-hidden">
        {/* Top action bar */}
        <div className="no-print bg-slate-50 border-b border-slate-200 px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Official Tax Receipt</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-sm transition"
            >
              <Printer size={14} /> Print / Save PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Printable invoice body */}
        <div id="printable-invoice" className="p-8 md:p-10 bg-white space-y-8 text-slate-900">
          {/* Header */}
          <div className="flex justify-between items-start border-b border-slate-200 pb-8">
            <div>
              <div className="flex items-center gap-2.5 mb-2">
                <img
                  src="/straight/icon-192.png"
                  alt="Straight Ltd"
                  className="w-10 h-10 rounded-xl object-cover"
                />
                <div>
                  <h1 className="text-xl font-extrabold tracking-tight text-slate-900">Straight Ltd.</h1>
                  <p className="text-xs text-slate-500">Enterprise Growth & Engagement Services</p>
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-2 font-mono">support@straight.ltd · straight.ltd</p>
            </div>
            <div className="text-right">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                <CheckCircle2 size={12} /> PAID
              </span>
              <p className="text-lg font-extrabold text-slate-900 mt-2">{invoiceNumber}</p>
              <p className="text-xs text-slate-500 mt-0.5">{dateFormatted}</p>
            </div>
          </div>

          {/* Client & Bill-to details */}
          <div className="grid grid-cols-2 gap-8 text-xs">
            <div>
              <p className="font-bold text-slate-400 uppercase tracking-wider mb-2">Billed To:</p>
              <p className="font-bold text-sm text-slate-900">{client.fullName || client.email.split('@')[0]}</p>
              <p className="text-slate-600 mt-0.5">{client.email}</p>
              {companyName && <p className="text-slate-700 font-medium mt-0.5">{companyName}</p>}
              {taxId && <p className="text-slate-500 font-mono mt-0.5">Tax/VAT ID: {taxId}</p>}

              <button
                type="button"
                onClick={() => setEditingDetails(!editingDetails)}
                className="no-print mt-2 text-[11px] font-semibold text-orange-600 hover:text-orange-700 underline block"
              >
                {editingDetails ? 'Done editing' : '+ Add company or VAT ID'}
              </button>

              {editingDetails && (
                <div className="no-print mt-3 space-y-2 p-3 bg-slate-50 rounded-xl ring-1 ring-slate-200">
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Company Name (optional)"
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                  <input
                    type="text"
                    value={taxId}
                    onChange={(e) => setTaxId(e.target.value)}
                    placeholder="Tax/VAT Number (optional)"
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                  />
                </div>
              )}
            </div>

            <div className="text-right">
              <p className="font-bold text-slate-400 uppercase tracking-wider mb-2">Payment Details:</p>
              <p className="text-slate-700 font-medium">Prepaid Straight Credits</p>
              <p className="text-slate-500 font-mono mt-0.5">Ref Order #{order.id}</p>
              <p className="text-slate-500 mt-0.5">Currency: USD ($)</p>
            </div>
          </div>

          {/* Line items table */}
          <div>
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 uppercase tracking-wider font-semibold">
                  <th className="py-2.5">Description</th>
                  <th className="py-2.5 text-right">Qty</th>
                  <th className="py-2.5 text-right">Unit Price</th>
                  <th className="py-2.5 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-3.5 pr-4">
                    <p className="font-bold text-slate-900">{serviceName}</p>
                    <p className="text-slate-500 font-mono text-[11px] mt-0.5 break-all">
                      Target: {order.thread_url}
                    </p>
                  </td>
                  <td className="py-3.5 text-right font-semibold text-slate-900">{order.requested_upvotes}</td>
                  <td className="py-3.5 text-right text-slate-600">{formatUSD(unitPriceCents)}</td>
                  <td className="py-3.5 text-right font-bold text-slate-900">{formatUSD(order.cost_credits)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="border-t border-slate-200 pt-4 flex justify-end">
            <div className="w-64 space-y-2 text-xs">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal:</span>
                <span className="font-semibold text-slate-900">{formatUSD(order.cost_credits)}</span>
              </div>
              <div className="flex justify-between text-slate-600">
                <span>Tax (0% VAT Reverse Charge):</span>
                <span>$0.00</span>
              </div>
              <div className="flex justify-between text-sm font-extrabold text-slate-900 border-t border-slate-200 pt-2">
                <span>Total Paid:</span>
                <span>{formatUSD(order.cost_credits)}</span>
              </div>
            </div>
          </div>

          {/* Footer notice */}
          <div className="border-t border-slate-100 pt-6 text-[11px] text-slate-400 text-center leading-relaxed">
            <p>Thank you for choosing Straight Ltd for your growth and organic presence campaigns.</p>
            <p className="mt-1">For questions regarding this receipt, please contact support@straight.ltd.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
