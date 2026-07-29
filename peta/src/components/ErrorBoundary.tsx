import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { supabase } from '../lib/supabase';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches React render errors, logs them to Supabase error_logs,
 * and shows a friendly fallback so the user isn't staring at a
 * white screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    // Log to Supabase (fire-and-forget, best-effort)
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/log_client_error`, {
      method: 'POST',
      headers: {
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY || '',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY || ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_error_type: 'react_error_boundary',
        p_error_message: error.message,
        p_error_stack: error.stack,
        p_url: window.location.href,
      }),
    }).catch(() => {}); // best-effort
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
          <div className="text-center max-w-md">
            <div className="text-4xl mb-4">😅</div>
            <h1 className="text-xl font-bold mb-2">Ada yang error nih</h1>
            <p className="text-sm text-gray-600 mb-4">
              Maaf, terjadi kesalahan yang tidak terduga. Tim kami udah otomatis dikasih tahu kok.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-primary text-white rounded-xl font-bold tap-shrink"
            >
              Coba Refresh
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Install global error handlers (window.onerror, unhandled promise rejection).
 * Call once at app bootstrap.
 */
export function installGlobalErrorHandler() {
  window.onerror = (_message, _source, _lineno, _colno, error) => {
    const msg = typeof _message === 'string' ? _message : (error?.message ?? 'unknown error');
    void supabase.rpc('log_client_error', {
      p_error_type: 'window_onerror',
      p_error_message: msg,
      p_error_stack: error?.stack ?? null,
      p_url: window.location.href,
    });
    return false;
  };

  window.onunhandledrejection = (event) => {
    const msg = event.reason?.message ?? event.reason?.toString() ?? 'unknown promise rejection';
    void supabase.rpc('log_client_error', {
      p_error_type: 'unhandled_promise_rejection',
      p_error_message: msg,
      p_error_stack: event.reason?.stack ?? null,
      p_url: window.location.href,
    });
  };
}
