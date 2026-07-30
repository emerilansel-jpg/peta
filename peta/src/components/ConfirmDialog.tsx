import React from 'react';
import { AlertTriangle, X } from 'lucide-react';

// Reusable in-app confirmation modal for destructive/irreversible actions.
// Replaces window.confirm() which is suppressible, race-able, spoofable, and
// leaves no audit trail. This modal blocks interaction until the user picks
// an explicit button and supports an optional typed-confirmation gate.
//
// Usage:
//   const [open, setOpen] = useState(false);
//   <button onClick={() => setOpen(true)}>...</button>
//   <ConfirmDialog
//     open={open}
//     title="Hapus member"
//     description="Tidak bisa di-undo."
//     confirmLabel="Hapus"
//     tone="danger"
//     onConfirm={() => del.mutate()}
//     onClose={() => setOpen(false)}
//   />

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' = red, 'warning' = amber. Default 'danger'. */
  tone?: 'danger' | 'warning';
  /** When set, the user must type this exact string before Confirm enables. */
  typeToConfirm?: string;
  /** Hint shown next to the type-to-confirm input. */
  typeHint?: string;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Konfirmasi',
  cancelLabel = 'Batal',
  tone = 'danger',
  typeToConfirm,
  typeHint,
  loading = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [typed, setTyped] = React.useState('');

  React.useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  if (!open) return null;

  const toneClasses =
    tone === 'danger'
      ? 'text-danger bg-danger/10 ring-danger/30'
      : 'text-warning bg-warning/10 ring-warning/30';
  const btnClasses =
    tone === 'danger'
      ? 'bg-danger hover:brightness-110 text-white'
      : 'bg-warning hover:brightness-110 text-white';

  const typeOk =
    !typeToConfirm || typed.trim().toLowerCase() === typeToConfirm.trim().toLowerCase();

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center animate-fade-in">
      <div className="absolute inset-0 bg-black/60" onClick={() => !loading && onClose()} />
      <div className="relative bg-white w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl shadow-2xl animate-slide-up safe-bottom">
        <div className="p-5">
          <div className="flex items-start justify-between mb-3">
            <div className={`w-10 h-10 rounded-xl ring-1 grid place-items-center shrink-0 ${toneClasses}`}>
              <AlertTriangle size={20} />
            </div>
            <button
              onClick={() => !loading && onClose()}
              disabled={loading}
              className="p-2 -mr-2 -mt-2 text-muted hover:text-dark disabled:opacity-50"
              aria-label="Tutup"
            >
              <X size={22} />
            </button>
          </div>

          <h3 className="text-lg font-extrabold text-dark mb-1.5">{title}</h3>
          {description && <div className="text-sm text-muted leading-relaxed mb-4">{description}</div>}

          {typeToConfirm && (
            <div className="mb-4">
              {typeHint && <p className="text-sm text-dark mb-1.5">{typeHint}</p>}
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={typeToConfirm}
                className="w-full min-h-[48px] px-4 py-3 text-base bg-light border-2 border-transparent rounded-xl focus:outline-none focus:border-primary focus:bg-white transition"
                autoFocus
                disabled={loading}
              />
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={loading}
              className="flex-1 py-3 rounded-xl font-bold text-dark bg-light hover:bg-border tap-shrink disabled:opacity-50"
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              disabled={loading || !typeOk}
              className={`flex-1 py-3 rounded-xl font-bold tap-shrink disabled:opacity-40 ${btnClasses}`}
            >
              {loading ? 'Memproses…' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
