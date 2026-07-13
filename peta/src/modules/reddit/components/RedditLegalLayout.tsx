import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

interface RedditLegalLayoutProps {
  children: React.ReactNode;
  title: string;
  lastUpdated?: string;
}

export function RedditLegalLayout({ children, title, lastUpdated = 'July 2026' }: RedditLegalLayoutProps) {
  const navigate = useNavigate();

  return (
    <div className="min-h-dvh bg-white text-slate-900 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <button
            onClick={() => navigate('/reddit')}
            className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft size={16} />
            Back to Straight Ltd
          </button>
          <Link to="/reddit" className="flex items-center gap-2">
            <img src="/straight/icon-192.png" alt="Straight Ltd" className="w-7 h-7 rounded-lg object-cover" />
            <span className="font-bold text-slate-900">Straight Ltd</span>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-3xl mx-auto px-6 py-16">
        <div className="mb-10">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900">{title}</h1>
          <p className="text-sm text-slate-500 mt-2">Last updated: {lastUpdated}</p>
        </div>

        <article className="prose prose-slate max-w-none prose-headings:text-slate-900 prose-headings:font-bold prose-a:text-orange-600 prose-a:no-underline hover:prose-a:underline prose-strong:text-slate-900">
          {children}
        </article>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-10">
        <div className="max-w-5xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <div className="flex items-center gap-2">
            <img src="/straight/icon-192.png" alt="Straight Ltd" className="w-6 h-6 rounded object-cover" />
            <span>Straight Ltd Pro · © {new Date().getFullYear()}</span>
          </div>
          <div className="flex gap-6">
            <Link to="/reddit/terms" className="hover:text-slate-900">Terms</Link>
            <Link to="/reddit/privacy" className="hover:text-slate-900">Privacy</Link>
            <Link to="/reddit/refunds" className="hover:text-slate-900">Refunds</Link>
            <Link to="/reddit/contact" className="hover:text-slate-900">Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
