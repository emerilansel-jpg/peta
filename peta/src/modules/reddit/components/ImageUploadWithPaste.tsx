import { useState, useRef, useEffect } from 'react';
import { Upload, Image as ImageIcon, Clipboard, X } from 'lucide-react';

interface ImageUploadWithPasteProps {
  value: File | null;
  onChange: (file: File | null) => void;
  maxSizeBytes?: number;
  label?: string;
  helperText?: string;
}

export function ImageUploadWithPaste({
  value,
  onChange,
  maxSizeBytes = 5 * 1024 * 1024,
  label = 'Upload screenshot',
  helperText,
}: ImageUploadWithPasteProps) {
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) {
      const url = URL.createObjectURL(value);
      setPreview(url);
      return () => URL.revokeObjectURL(url);
    }
    setPreview(null);
  }, [value]);

  const validate = (file: File): string | null => {
    if (!file.type.startsWith('image/')) {
      return 'File must be an image (PNG, JPG, WebP, GIF)';
    }
    if (file.size > maxSizeBytes) {
      return `File must be under ${(maxSizeBytes / 1024 / 1024).toFixed(0)}MB`;
    }
    return null;
  };

  const handleFile = (file: File) => {
    setError(null);
    const err = validate(file);
    if (err) {
      setError(err);
      return;
    }
    onChange(file);
  };

  const handlePaste = (e: React.ClipboardEvent | ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          // Rename pasted image with timestamp + correct extension
          const ext = item.type.split('/')[1] || 'png';
          const renamed = new File([file], `pasted-${Date.now()}.${ext}`, { type: item.type });
          handleFile(renamed);
          e.preventDefault();
          return;
        }
      }
    }
  };

  // Global paste listener when container is focused/hovered
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onPaste = (e: ClipboardEvent) => {
      // Only handle if container is focused or recently interacted
      if (document.activeElement === container || container.contains(document.activeElement)) {
        handlePaste(e);
      }
    };

    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  if (value && preview) {
    return (
      <div className="space-y-2">
        <div className="relative rounded-lg ring-1 ring-emerald-200 bg-emerald-50 p-3">
          <div className="flex items-start gap-3">
            <img src={preview} alt="Preview" className="w-20 h-20 object-cover rounded ring-1 ring-slate-200" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-emerald-900 text-sm truncate">{value.name}</p>
              <p className="text-xs text-emerald-700">{(value.size / 1024).toFixed(0)} KB · {value.type}</p>
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setError(null);
                }}
                className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-700"
              >
                <X size={12} />
                Remove and choose another
              </button>
            </div>
          </div>
        </div>
        {error && (
          <p className="text-xs text-rose-600">{error}</p>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onFocus={() => setError(null)}
      className={`relative outline-none rounded-xl ring-2 ring-dashed transition-all ${
        dragging
          ? 'ring-orange-400 bg-orange-50'
          : 'ring-slate-300 hover:ring-slate-400 bg-slate-50/50'
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      <div className="p-6 text-center">
        <div className="flex justify-center gap-2 mb-3">
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
            <Upload size={18} className="text-slate-500" />
          </div>
          <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
            <Clipboard size={18} className="text-blue-500" />
          </div>
        </div>

        <p className="font-semibold text-slate-900">{label}</p>
        <p className="text-xs text-slate-500 mt-1">
          <strong className="text-slate-700">Click</strong> to upload, <strong className="text-slate-700">drag & drop</strong>, or{' '}
          <strong className="text-blue-600">paste from clipboard (Ctrl+V)</strong>
        </p>
        {helperText && (
          <p className="text-xs text-slate-400 mt-2">{helperText}</p>
        )}

        <label className="mt-4 inline-block">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
            className="sr-only"
          />
          <span className="px-4 py-2 rounded-lg bg-white ring-1 ring-slate-300 hover:bg-slate-50 text-sm font-semibold text-slate-700 cursor-pointer inline-flex items-center gap-1.5">
            <ImageIcon size={14} />
            Choose file
          </span>
        </label>
      </div>

      {error && (
        <div className="px-6 pb-4">
          <p className="text-xs text-rose-600 text-center">{error}</p>
        </div>
      )}
    </div>
  );
}
