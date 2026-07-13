import { RedditLegalLayout } from '../components/RedditLegalLayout';
import { Mail, MessageSquare, Clock, MapPin } from 'lucide-react';

export function ContactPage() {
  return (
    <RedditLegalLayout title="Contact Us">
      <p>
        Have a question about your order, need help with the dashboard, or want to discuss a custom campaign? Our team is here to help.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 not-prose my-8">
        <div className="p-5 rounded-2xl bg-slate-50 ring-1 ring-slate-200">
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center mb-4">
            <Mail size={20} className="text-orange-600" />
          </div>
          <h3 className="font-bold text-slate-900 mb-1">Email</h3>
          <p className="text-sm text-slate-600 mb-2">For order questions, billing, and general support.</p>
          <a href="mailto:care@straight.ltd" className="text-orange-600 font-semibold hover:underline">
            care@straight.ltd
          </a>
        </div>

        <div className="p-5 rounded-2xl bg-slate-50 ring-1 ring-slate-200">
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center mb-4">
            <MessageSquare size={20} className="text-orange-600" />
          </div>
          <h3 className="font-bold text-slate-900 mb-1">In-dashboard chat</h3>
          <p className="text-sm text-slate-600 mb-2">
            Every order has a built-in conversation thread. Message our team directly from your order detail page.
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-slate-50 ring-1 ring-slate-200">
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center mb-4">
            <Clock size={20} className="text-orange-600" />
          </div>
          <h3 className="font-bold text-slate-900 mb-1">Response time</h3>
          <p className="text-sm text-slate-600">
            We typically reply within 90 minutes during business hours. Complex order reviews may take a little longer.
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-slate-50 ring-1 ring-slate-200">
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center mb-4">
            <MapPin size={20} className="text-orange-600" />
          </div>
          <h3 className="font-bold text-slate-900 mb-1">Company</h3>
          <p className="text-sm text-slate-600">
            Straight Ltd Pro<br />
            Operating online at straight.ltd
          </p>
        </div>
      </div>

      <h2>Before you reach out</h2>
      <p>
        Check your order detail page for real-time status and delivery proof. Many common questions — such as "where is my order?" or "how many upvotes have been delivered?" — are answered there automatically.
      </p>
      <p>
        For billing issues, please include your PayPal transaction ID or order number so we can help you faster.
      </p>
    </RedditLegalLayout>
  );
}
